/**
 * Documenso proposal/signing repair — mergeDocumensoRecipientSources().
 * Run: npx tsx tests/documenso-recipient-merge.test.ts
 *
 * Pins that a recipient's Documenso `id` is never dropped: it is what MyPayLink
 * persists (documenso_recipient_ids / contract_signers.documenso_recipient_id)
 * and later uses to resync signer status. If /envelope/distribute returns
 * recipients without ids (or none), the ids from /envelope/create are merged in.
 */
import { mergeDocumensoRecipientSources } from "../server/services/documenso";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d?: string) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}${d ? ` — ${d}` : ""}`); } };

console.log("mergeDocumensoRecipientSources");
{
  // Happy path: distribute returns everything.
  const links = mergeDocumensoRecipientSources(
    [{ id: 90, name: "A", email: "a@x.com", token: "tokA", signingUrl: "https://d/sign/tokA" }],
    [{ id: 90, name: "A", email: "a@x.com" }],
  );
  ok("distribute has full data → 1 link with id, token, signingUrl",
    links.length === 1 && links[0].id === "90" && links[0].token === "tokA" && links[0].signingUrl === "https://d/sign/tokA");
}
{
  // The bug case: distribute omits the recipient id → take it from create.
  const links = mergeDocumensoRecipientSources(
    [{ name: "A", email: "a@x.com", token: "tokA", signingUrl: "https://d/sign/tokA" }], // no id
    [{ id: 90, name: "A", email: "a@x.com" }],
  );
  ok("distribute missing id → id recovered from create", links.length === 1 && links[0].id === "90");
  ok("distribute missing id → token/signingUrl still from distribute", links[0].token === "tokA" && links[0].signingUrl === "https://d/sign/tokA");
}
{
  // Worst case: distribute returns NO recipients at all.
  const links = mergeDocumensoRecipientSources(
    undefined,
    [{ id: 91, name: "B", email: "b@x.com", token: "tokB" }],
  );
  ok("distribute returns nothing → create recipients still surface with ids",
    links.length === 1 && links[0].id === "91" && links[0].email === "b@x.com");
  ok("signingUrl synthesized from token when only create is available",
    !!links[0].signingUrl && links[0].signingUrl!.endsWith("/sign/tokB"));
}
{
  // Two recipients, distribute only echoes one.
  const links = mergeDocumensoRecipientSources(
    [{ id: 1, email: "one@x.com", token: "t1", signingUrl: "u1" }],
    [{ id: 1, email: "one@x.com" }, { id: 2, email: "two@x.com", token: "t2" }],
  );
  ok("recipient present only in create is appended (not lost)",
    links.length === 2 && links.map((l) => l.id).sort().join(",") === "1,2");
  ok("no duplicate for the recipient in both sources", links.filter((l) => l.email === "one@x.com").length === 1);
}
{
  // recipientId alias + case-insensitive email match.
  const links = mergeDocumensoRecipientSources(
    [{ email: "MixedCase@X.com", token: "t" }],
    [{ recipientId: 55, email: "mixedcase@x.com" }],
  );
  ok("matches on email case-insensitively; recipientId alias accepted", links.length === 1 && links[0].id === "55");
}
{
  ok("both sources empty → empty list (no throw)", mergeDocumensoRecipientSources(null, null).length === 0);
  ok("null-safe on malformed entries", mergeDocumensoRecipientSources([{}], [{}]).length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
