import { req, ORG_ID, WORKSPACE_ID, AUTOMATION_ID } from "./kognitos";

const RESOURCE_PREFIX = `organizations/${ORG_ID}/workspaces/${WORKSPACE_ID}`;

export interface QuillSpyCode {
  toolCallId: string;
  code: string;
}

export interface QuillResult {
  answer: string;
  spyCode: QuillSpyCode[];
  threadId: string;
  executionIds: string[];
  thinkingSteps: string[];
}

export async function createQuillThread(
  automationId: string = AUTOMATION_ID!
): Promise<string> {
  const res = await req(
    `/${RESOURCE_PREFIX}/agents/quill/threads`,
    {
      method: "POST",
      body: JSON.stringify({
        automation: `${RESOURCE_PREFIX}/automations/${automationId}`,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to create Quill thread: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.name.split("/threads/").pop()!;
}

export async function askQuill(
  threadId: string,
  question: string
): Promise<QuillResult> {
  const res = await req(
    `/${RESOURCE_PREFIX}/agents/quill/threads/${threadId}:sendMessage`,
    {
      method: "POST",
      headers: { Accept: "application/x-ndjson" },
      body: JSON.stringify({
        user_message: {
          user_message: {
            user_message_type: "user_query",
            content_list: { items: [{ text: question }] },
          },
        },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Quill sendMessage failed: ${res.status} ${await res.text()}`);
  }

  const raw = await res.text();
  return parseNdjsonResponse(raw, threadId);
}

function parseNdjsonResponse(raw: string, threadId: string): QuillResult {
  const objects = extractJsonObjects(raw);

  const spyCode: QuillSpyCode[] = [];
  const executionIds: string[] = [];
  const thinkingSteps: string[] = [];
  let answer = "";

  for (const obj of objects) {
    if (obj.progress_notification?.progress_type === "thinking" && obj.progress_notification.content) {
      thinkingSteps.push(obj.progress_notification.content);
    }

    if (obj.tool_call_request?.display_name === "mcp__custom_tools__execute_code") {
      try {
        const input = JSON.parse(obj.tool_call_request.input);
        if (input.code) {
          spyCode.push({
            toolCallId: obj.tool_call_request.tool_call_id,
            code: input.code,
          });
        }
      } catch { /* malformed input */ }
    }

    if (obj.artifact?.artifact_type === "execution_reference") {
      try {
        const content = JSON.parse(obj.artifact.content);
        if (content.execution_id) executionIds.push(content.execution_id);
      } catch { /* malformed artifact */ }
    }

    if (obj.completion_response?.content) {
      answer = obj.completion_response.content;
    } else if (obj.agent_message?.content && obj.state === "STATE_COMPLETE") {
      answer = obj.agent_message.content;
    }
  }

  if (!answer) {
    const lastAgent = [...objects].reverse().find((o) => o.agent_message?.content);
    if (lastAgent) answer = lastAgent.agent_message.content;
  }

  return { answer, spyCode, threadId, executionIds, thinkingSteps };
}

function extractJsonObjects(raw: string): Record<string, any>[] {
  const objects: Record<string, any>[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (raw[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          objects.push(JSON.parse(raw.slice(start, i + 1)));
        } catch { /* skip malformed */ }
        start = -1;
      }
    }
  }

  return objects;
}

/**
 * One-shot helper: create a thread, ask a question, return the result.
 */
export async function askQuillOneShot(
  question: string,
  automationId?: string
): Promise<QuillResult> {
  const threadId = await createQuillThread(automationId);
  return askQuill(threadId, question);
}
