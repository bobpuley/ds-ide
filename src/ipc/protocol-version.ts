// FR-DEV-6: bump whenever the wire protocol changes incompatibly. Keep in
// sync with emulator/runtime/ipc_server.h's kProtocolVersion — a connect-time
// mismatch between the two is treated as an incompatible emulator/extension
// pairing (see EmulatorManager's protocol handshake in manager.ts).
// v2 (FR-WIN-IPC-1..3): TCP announce "127.0.0.1:<port>", session hello on
// TCP, and the host-to-emulator "shutdown" message.
export const PROTOCOL_VERSION = 2;
