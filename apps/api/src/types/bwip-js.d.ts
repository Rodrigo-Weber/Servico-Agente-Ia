declare module "bwip-js" {
  interface ToBufferOptions {
    bcid: string;
    text: string;
    scale?: number;
    height?: number;
    includetext?: boolean;
    backgroundcolor?: string;
    [key: string]: unknown;
  }

  interface BwipJs {
    toBuffer(options: ToBufferOptions): Promise<Buffer>;
  }

  const bwipjs: BwipJs;
  export default bwipjs;
}
