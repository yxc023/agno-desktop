/**
 * 给 message-types 提供一些工具
 */

import type { ChatMessage } from "./message-types";

export function generateIdPlaceholder(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export type {
  ChatMessage,
  MessagePart,
  ToolCallPart,
  TextPart,
  ReasoningPart,
  ReferencePart,
  ImagePart,
  AudioPart,
  VideoPart,
  ErrorPart,
  MessageRole,
  MessageStatus,
  SessionMeta,
  ToolCallStatus,
} from "./message-types";