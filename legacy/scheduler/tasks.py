"""Task model — defines the structure of scheduled tasks."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class TaskSchedule:
    type: str  # "once", "recurring", "cron"
    at: str | None = None  # ISO datetime for one-shot
    every: str | None = None  # For recurring: "1h", "4h", "1d", "1w"
    cron: str | None = None  # Cron expression
    until: str | None = None  # Optional end date

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"type": self.type}
        if self.at:
            d["at"] = self.at
        if self.every:
            d["every"] = self.every
        if self.cron:
            d["cron"] = self.cron
        if self.until:
            d["until"] = self.until
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TaskSchedule:
        return cls(
            type=data["type"],
            at=data.get("at"),
            every=data.get("every"),
            cron=data.get("cron"),
            until=data.get("until"),
        )


@dataclass
class TaskAction:
    type: str  # "remind", "check", "run_prompt"
    channel: str = "slack"  # "slack", "email", "internal"
    prompt: str = ""  # For "run_prompt"
    message: str = ""  # For "remind"

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"type": self.type, "channel": self.channel}
        if self.prompt:
            d["prompt"] = self.prompt
        if self.message:
            d["message"] = self.message
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TaskAction:
        return cls(
            type=data["type"],
            channel=data.get("channel", "slack"),
            prompt=data.get("prompt", ""),
            message=data.get("message", ""),
        )


@dataclass
class Task:
    id: str
    customer: str
    description: str
    schedule: TaskSchedule
    action: TaskAction
    status: str = "active"  # "active", "completed", "cancelled"
    created_at: str = ""
    created_by: str = "system"
    last_run: str | None = None
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "customer": self.customer,
            "description": self.description,
            "schedule": self.schedule.to_dict(),
            "action": self.action.to_dict(),
            "status": self.status,
            "created_at": self.created_at,
            "created_by": self.created_by,
            "last_run": self.last_run,
            "tags": self.tags,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Task:
        return cls(
            id=data["id"],
            customer=data["customer"],
            description=data["description"],
            schedule=TaskSchedule.from_dict(data["schedule"]),
            action=TaskAction.from_dict(data["action"]),
            status=data.get("status", "active"),
            created_at=data.get("created_at", ""),
            created_by=data.get("created_by", "system"),
            last_run=data.get("last_run"),
            tags=data.get("tags", []),
        )
