export const isPagesDemo = import.meta.env.MODE === "pages-demo";
export const browserStoragePrefix = isPagesDemo
  ? "call-footprint.pages-demo.v1"
  : "call-footprint";
