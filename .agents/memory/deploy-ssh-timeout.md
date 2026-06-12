---
name: deploy-app.yml SSH dial timeout
description: GitHub auto-deploy can fail at the SSH step while production is fine; how to interpret it.
---
`deploy-app.yml` deploys to the VPS via `appleboy/ssh-action` (SSH from a GitHub-hosted runner). It can fail with `dial tcp ***:*** : i/o timeout` — the runner could not open the SSH connection, so the deploy script never ran on the box.

**Why:** This is infra/connectivity (VPS sshd down, firewall/IP allowlist not permitting GitHub runner IPs, or a transient outage), NOT a code/build problem. build/test/repo-audit passing while only the "Deploy to VPS" step fails is the signature.

**How to apply:**
- A red `deploy-app.yml` run does NOT mean production is down. Verify independently: `curl https://mypaylink.app/health` (expect `{"status":"ok"}`) and `/ready` (expect `database":"connected"`).
- When the SSH step times out, the merged code reaches prod only via a manual VPS deploy. Push-to-deploy stays broken until SSH connectivity is restored.
- Fetch the failing step log via the Actions logs API (zip entry `Deploy to VPS/3_Deploy to VPS.txt`); the dial-timeout line is at the very end after the echoed script body.
