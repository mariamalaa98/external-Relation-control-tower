import { getClient } from "@microsoft/power-apps/data";
import { dataSourcesInfo } from "../../.power/schemas/appschemas/dataSourcesInfo";

const BLOCK = 3_500_000;
const ACTION_TABLE = "erc_licenseandcontracts";

type ApiDef = {
  path: string;
  method: string;
  parameters: { name: string; in: string; type: string }[];
};

const FILE_ACTIONS: Record<string, ApiDef> = {
  InitializeFileBlocksUpload: {
    path: "api/data/v9.2/InitializeFileBlocksUpload",
    method: "POST",
    parameters: [
      { name: "Target", in: "body", type: "object" },
      { name: "FileAttributeName", in: "body", type: "string" },
      { name: "FileName", in: "body", type: "string" },
    ],
  },
  UploadBlock: {
    path: "api/data/v9.2/UploadBlock",
    method: "POST",
    parameters: [
      { name: "BlockId", in: "body", type: "string" },
      { name: "BlockData", in: "body", type: "string" },
      { name: "FileContinuationToken", in: "body", type: "string" },
    ],
  },
  CommitFileBlocksUpload: {
    path: "api/data/v9.2/CommitFileBlocksUpload",
    method: "POST",
    parameters: [
      { name: "FileContinuationToken", in: "body", type: "string" },
      { name: "FileSizeInBytes", in: "body", type: "number" },
      { name: "BlockList", in: "body", type: "array" },
    ],
  },
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function fileBlockId() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

function resultMessage(result: { success?: boolean; error?: unknown }, fallback: string) {
  const error = result?.error;
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && (error as { message?: unknown }).message) {
    return String((error as { message?: unknown }).message);
  }
  return fallback;
}

function ensureFileApis() {
  const table = dataSourcesInfo[ACTION_TABLE] as { apis: Record<string, ApiDef> };
  Object.assign(table.apis, FILE_ACTIONS);
}

async function runFileAction(name: string, body: Record<string, unknown>) {
  ensureFileApis();
  const result = await getClient(dataSourcesInfo).executeAsync<Record<string, unknown>, Record<string, unknown>>({
    dataverseRequest: {
      action: "customapi",
      parameters: {
        operationName: name,
        tableName: ACTION_TABLE,
        body,
      },
    },
  });
  if (result?.success === false) throw new Error(resultMessage(result, `${name} failed`));
  return (result.data || {}) as Record<string, unknown>;
}

async function uploadWithFileBlocks(input: {
  entityLogicalName: string;
  recordId: string;
  attribute: string;
  file: File;
  bytes: Uint8Array;
}) {
  const started = await runFileAction("InitializeFileBlocksUpload", {
    Target: {
      "@odata.type": `Microsoft.Dynamics.CRM.${input.entityLogicalName}`,
      [`${input.entityLogicalName}id`]: input.recordId,
    },
    FileAttributeName: input.attribute,
    FileName: input.file.name,
  });
  const token = String(started.FileContinuationToken || "");
  if (!token) throw new Error("Dataverse did not return a file upload token");

  const blockList: string[] = [];
  if (!input.bytes.length) {
    const blockId = fileBlockId();
    blockList.push(blockId);
    await runFileAction("UploadBlock", {
      BlockId: blockId,
      BlockData: "",
      FileContinuationToken: token,
    });
  } else {
    for (let offset = 0; offset < input.bytes.length; offset += BLOCK) {
      const blockId = fileBlockId();
      blockList.push(blockId);
      await runFileAction("UploadBlock", {
        BlockId: blockId,
        BlockData: bytesToBase64(input.bytes.subarray(offset, offset + BLOCK)),
        FileContinuationToken: token,
      });
    }
  }
  await runFileAction("CommitFileBlocksUpload", {
    FileContinuationToken: token,
    FileSizeInBytes: input.bytes.length,
    BlockList: blockList,
  });
}

/**
 * Attach a File column using the native Dataverse client (same path as create),
 * not the Common Data Service connector (that needs an organization URL and
 * sends Content-Type twice).
 */
export async function uploadDataverseFileColumn(input: {
  entityLogicalName: string;
  entitySetName: string;
  recordId: string;
  attribute: string;
  file: File;
}) {
  const id = input.recordId.replace(/[{}]/g, "");
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const native = await getClient(dataSourcesInfo).uploadFileToRecord(
    input.entitySetName,
    id,
    input.attribute,
    input.file.name,
    bytes,
  );
  if (native?.success !== false) return;
  const detail = resultMessage(native, "Native file upload failed");
  try {
    await uploadWithFileBlocks({ ...input, recordId: id, bytes });
  } catch (err) {
    const blocks = err instanceof Error ? err.message : String(err);
    throw new Error(`${detail} ${blocks}`);
  }
}
