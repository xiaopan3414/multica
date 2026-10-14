import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, lstatSync, readlinkSync } from "node:fs";
import path from "node:path";

const [archive, extractedRoot, revision = "HEAD"] = process.argv.slice(2);
if (!archive || !extractedRoot) {
  throw new Error("Usage: node verify-git-source-archive.mjs <archive.tar> <extracted-root> [revision]");
}
const commit = execFileSync("git", ["rev-parse", revision], { encoding: "utf8" }).trim();
const tree = execFileSync("git", ["ls-tree", "-r", "-z", commit], {
  encoding: "utf8", maxBuffer: 256 << 20,
});
const entries = new Map(tree.split("\0").filter(Boolean).map(record => {
  const tab = record.indexOf("\t");
  const [mode, type, oid] = record.slice(0, tab).split(" ");
  return [record.slice(tab + 1), { mode, type, oid }];
}));
const members = execFileSync("tar", ["-tf", archive], { encoding: "utf8", maxBuffer: 256 << 20 })
  .split(/\r?\n/).filter(name => name && !name.endsWith("/"));
if (new Set(members).size !== members.length) throw new Error("Duplicate archive members");
const blobs = members.map(name => {
  const entry = entries.get(name);
  if (!entry || entry.type !== "blob" || !["100644", "100755", "120000"].includes(entry.mode)) {
    throw new Error("Archive member is not a supported Git blob: " + name);
  }
  return { name, ...entry };
});
const data = execFileSync("git", ["cat-file", "--batch"], {
  input: blobs.map(entry => entry.oid).join("\n") + "\n", maxBuffer: 256 << 20,
});
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const resolvedRoot = path.resolve(extractedRoot);
let offset = 0;
for (const entry of blobs) {
  const end = data.indexOf(10, offset);
  const [oid, type, lengthText] = data.subarray(offset, end).toString().split(" ");
  const length = Number(lengthText);
  if (oid !== entry.oid || type !== "blob" || !Number.isSafeInteger(length)) {
    throw new Error("Invalid Git blob response: " + entry.name);
  }
  const target = path.resolve(resolvedRoot, entry.name);
  if (!target.startsWith(resolvedRoot + path.sep)) throw new Error("Member outside extraction root");
  const source = data.subarray(end + 1, end + 1 + length);
  const actual = lstatSync(target).isSymbolicLink()
    ? Buffer.from(readlinkSync(target)) : readFileSync(target);
  if (sha256(source) !== sha256(actual)) throw new Error("Archive bytes differ from Git blob: " + entry.name);
  offset = end + 2 + length;
}
console.log(JSON.stringify({
  sourceCommit: commit, sourceArchiveSha256: sha256(readFileSync(archive)),
  archiveMembersMatchedGitBlobs: blobs.length,
}));
