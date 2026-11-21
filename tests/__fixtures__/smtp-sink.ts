/**
 * Test fixture: a minimal SMTP sink on 127.0.0.1 — the captured local mailbox.
 * EHLO/AUTH/MAIL/RCPT/DATA; mode "fail" answers 451 to DATA. Nothing leaves the
 * machine. (Same protocol handling as the PR 2 invite test's inline sink.)
 */
import net from "node:net";

export interface SmtpSink { port: number; messages: { rcpt: string[]; raw: string }[]; setMode(m: "ok" | "fail"): void; close(): Promise<void> }

export function startSmtpSink(): Promise<SmtpSink> {
  const messages: { rcpt: string[]; raw: string }[] = [];
  let mode: "ok" | "fail" = "ok";
  const server = net.createServer((sock) => {
    let buf = "", inData = false, authStep = 0; let cur = { rcpt: [] as string[], raw: "" };
    sock.write("220 sink.local ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n"); if (end < 0) return;
          cur.raw = buf.slice(0, end); buf = buf.slice(end + 5); inData = false;
          if (mode === "fail") sock.write("451 4.3.0 try again later\r\n"); else { messages.push(cur); sock.write("250 2.0.0 queued\r\n"); }
          cur = { rcpt: [], raw: "" }; continue;
        }
        const i = buf.indexOf("\r\n"); if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (authStep === 1) { authStep = 2; sock.write("334 UGFzc3dvcmQ6\r\n"); continue; }
        if (authStep === 2) { authStep = 0; sock.write("235 2.7.0 ok\r\n"); continue; }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO") sock.write("250-sink.local\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
        else if (cmd === "HELO") sock.write("250 sink.local\r\n");
        else if (cmd === "AUTH") { if (/LOGIN/i.test(line)) { authStep = 1; sock.write("334 VXNlcm5hbWU6\r\n"); } else sock.write("235 2.7.0 ok\r\n"); }
        else if (cmd === "RCPT") { cur.rcpt.push(line); sock.write("250 2.1.5 ok\r\n"); }
        else if (cmd === "DATA") { inData = true; sock.write("354 go\r\n"); }
        else if (cmd === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
        else sock.write("250 ok\r\n");
      }
    });
    sock.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as net.AddressInfo).port;
    resolve({ port, messages, setMode: (m) => { mode = m; }, close: () => new Promise((r) => server.close(() => r())) });
  }));
}
/** Decode the message body (quoted-printable / base64 parts) to plain text for inspection. */
export function decodeMail(raw: string): string {
  let out = raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  for (const m of raw.matchAll(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/g)) out += "\n" + Buffer.from(m[1].replace(/\s+/g, ""), "base64").toString("utf8");
  return out;
}
