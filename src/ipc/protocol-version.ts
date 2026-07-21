// FR-DEV-6: bump whenever the wire protocol changes incompatibly. Keep in
// sync with emulator/runtime/ipc_server.h's kProtocolVersion — a connect-time
// mismatch between the two is treated as an incompatible emulator/extension
// pairing (see EmulatorManager's protocol handshake in manager.ts).
export const PROTOCOL_VERSION = 1;
