import { getClient } from "@microsoft/power-apps/data";
import { dataSourcesInfo } from "../../.power/schemas/appschemas/dataSourcesInfo";
import type { IGetAllOptions, IGetOptions } from "../generated/models/CommonModels";
import { EmailsService } from "../generated/services/EmailsService";
import type { EmailAttachment } from "./types";

const ATTACHMENT_TABLES = ["activitymimeattachments", "activitymimeattachment"] as const;
const client = getClient(dataSourcesInfo);

export const EMAIL_ATTACHMENT_EXPAND =
  "email_activity_mime_attachment($select=activitymimeattachmentid,filename,filesize,mimetype,subject,attachmentcontentid,body)";

type ActivityMimeAttachment = {
  activitymimeattachmentid?: string;
  filename?: string;
  filesize?: number | string;
  mimetype?: string;
  subject?: string;
  body?: string;
  attachmentcontentid?: string;
  _objectid_value?: string;
  [key: string]: unknown;
};

export function mimeFromFileName(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    xml: "text/xml",
    html: "text/html",
    htm: "text/html",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    zip: "application/zip",
    msg: "application/vnd.ms-outlook",
    eml: "message/rfc822",
  };
  return map[ext] || "application/octet-stream";
}

export function formatBytes(size?: number) {
  if (!size || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export type AttachmentPreviewKind = "image" | "pdf" | "text" | "download";

export function previewKind(att: Pick<EmailAttachment, "name" | "mimeType" | "localBody">): AttachmentPreviewKind {
  if (att.localBody) return "text";
  const mime = (att.mimeType || "").toLowerCase();
  const name = att.name || "";
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) return "image";
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (
    mime.startsWith("text/")
    || mime === "application/json"
    || mime === "application/xml"
    || /\.(txt|csv|log|json|xml|html?|md)$/i.test(name)
  ) return "text";
  return "download";
}

function cleanGuid(id: string) {
  return (id || "").replace(/[{}]/g, "");
}

function mapRow(row: ActivityMimeAttachment, emailId: string): EmailAttachment | null {
  const id = String(row.activitymimeattachmentid || row["activitymimeattachmentid"] || "");
  if (!id) return null;
  const name = String(row.filename || row.subject || "attachment");
  const body = typeof row.body === "string" && row.body.trim() ? row.body.trim() : undefined;
  return {
    id,
    name,
    mimeType: String(row.mimetype || mimeFromFileName(name)),
    size: Number(row.filesize) || 0,
    inline: !!row.attachmentcontentid,
    emailId,
    localBytesBase64: body,
  };
}

export function attachmentsFromEmailRecord(email: unknown, emailId: string): EmailAttachment[] {
  if (!email || typeof email !== "object") return [];
  const record = email as Record<string, unknown>;
  const buckets = [
    record.email_activity_mime_attachment,
    record.email_activity_mime_attachments,
    record.activitymimeattachments,
    record.email_FileAttachments,
  ];
  const rows: EmailAttachment[] = [];
  for (const bucket of buckets) {
    const list = Array.isArray(bucket) ? bucket : bucket ? [bucket] : [];
    for (const item of list) {
      const mapped = mapRow((item || {}) as ActivityMimeAttachment, emailId);
      if (mapped) rows.push(mapped);
    }
    if (rows.length) return rows;
  }
  return rows;
}

export const emailGetOptions = { expand: EMAIL_ATTACHMENT_EXPAND } as IGetOptions;

async function fromEmailExpand(emailId: string): Promise<EmailAttachment[]> {
  const id = cleanGuid(emailId);
  try {
    const result = await EmailsService.get(id, emailGetOptions);
    const rows = attachmentsFromEmailRecord(result.data, emailId);
    if (rows.length) return rows;
  } catch { /* try getAll with expand */ }
  try {
    const result = await EmailsService.getAll({
      top: 1,
      filter: `activityid eq ${id}`,
      ...emailGetOptions,
    } as IGetAllOptions);
    const rows = attachmentsFromEmailRecord(result.data?.[0], emailId);
    if (rows.length) return rows;
  } catch {
    return [];
  }
  return [];
}

async function fromAttachmentTable(emailId: string): Promise<EmailAttachment[]> {
  const id = cleanGuid(emailId);
  if (!id) return [];
  const filters = [
    `_objectid_value eq ${id}`,
    `_objectid_value eq '${id}'`,
    `objectid_email/activityid eq ${id}`,
  ];
  for (const table of ATTACHMENT_TABLES) {
    for (const filter of filters) {
      try {
        const result = await client.retrieveMultipleRecordsAsync<ActivityMimeAttachment>(
          table,
          {
            top: 50,
            filter,
            select: ["activitymimeattachmentid", "filename", "filesize", "mimetype", "subject", "attachmentcontentid"],
          } as IGetAllOptions,
        );
        const rows = (result.data || [])
          .map((row) => mapRow(row, emailId))
          .filter((row): row is EmailAttachment => !!row);
        if (rows.length) return rows;
      } catch {
        /* try the next table name / filter */
      }
    }
  }
  return [];
}

export async function listAttachmentsForEmails(emailIds: string[]): Promise<Map<string, EmailAttachment[]>> {
  const grouped = new Map<string, EmailAttachment[]>();
  const ids = [...new Set(emailIds.filter(Boolean))];
  await Promise.all(ids.map(async (emailId) => {
    let rows = await fromEmailExpand(emailId);
    if (!rows.length) rows = await fromAttachmentTable(emailId);
    grouped.set(emailId, rows);
  }));
  return grouped;
}

function base64ToBytes(value: string) {
  const clean = value.replace(/\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeBody(body: unknown): Uint8Array | null {
  if (!body) return null;
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body !== "string") return null;
  const trimmed = body.trim();
  if (!trimmed) return null;
  try {
    return base64ToBytes(trimmed);
  } catch {
    return new TextEncoder().encode(body);
  }
}

export async function fetchAttachmentContent(att: EmailAttachment): Promise<{ bytes: Uint8Array; name: string; mimeType: string }> {
  if (att.localBody) {
    const bytes = new TextEncoder().encode(att.localBody);
    return { bytes, name: att.name, mimeType: att.mimeType || "text/plain" };
  }
  if (att.localBytesBase64) {
    return {
      bytes: base64ToBytes(att.localBytesBase64),
      name: att.name,
      mimeType: att.mimeType || mimeFromFileName(att.name),
    };
  }

  for (const table of ATTACHMENT_TABLES) {
    try {
      const result = await client.retrieveRecordAsync<ActivityMimeAttachment>(
        table,
        att.id,
        { select: ["body", "filename", "mimetype", "filesize"] } as IGetOptions,
      );
      const row = result.data;
      if (!row) continue;
      let bytes = decodeBody(row.body);
      if (!bytes?.length) {
        try {
          const file = await client.downloadFileFromRecord(table, att.id, "body");
          bytes = decodeBody(file.data);
        } catch {
          bytes = null;
        }
      }
      if (!bytes?.length) continue;
      const name = row.filename || att.name || "attachment";
      return { bytes, name, mimeType: row.mimetype || att.mimeType || mimeFromFileName(name) };
    } catch {
      /* try the other table name */
    }
  }
  throw new Error("This attachment has no file content to open");
}

export function bytesToObjectUrl(bytes: Uint8Array, mimeType: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mimeType || "application/octet-stream" });
  return URL.createObjectURL(blob);
}

export function downloadBytes(bytes: Uint8Array, name: string, mimeType: string) {
  const url = bytesToObjectUrl(bytes, mimeType);
  const a = document.createElement("a");
  a.href = url;
  a.download = name || "attachment";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function decodeText(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}
