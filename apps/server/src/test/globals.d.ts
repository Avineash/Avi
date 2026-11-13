// Tests treat API responses as loosely typed JSON; production code never uses this.
export {};
declare global {
  interface Response { json(): Promise<any> }
}
