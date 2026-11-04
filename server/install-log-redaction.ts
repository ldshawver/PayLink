// Side-effect entry: must be the FIRST import of server/index.ts so every
// module's import-time and runtime console output is redacted (PR-E2).
import { installConsoleRedaction, installFatalExceptionRedaction } from "./log-redaction";

installConsoleRedaction();
installFatalExceptionRedaction();
