// Label colours WorkDesk offers. Gmail only accepts colours from its own palette, so these pairs are taken
// from it (background + readable text colour).
export const LABEL_COLORS = [
  { name: "Red", backgroundColor: "#fb4c2f", textColor: "#ffffff" },
  { name: "Orange", backgroundColor: "#ffad47", textColor: "#ffffff" },
  { name: "Yellow", backgroundColor: "#fad165", textColor: "#000000" },
  { name: "Green", backgroundColor: "#16a766", textColor: "#ffffff" },
  { name: "Teal", backgroundColor: "#43d692", textColor: "#000000" },
  { name: "Blue", backgroundColor: "#4a86e8", textColor: "#ffffff" },
  { name: "Purple", backgroundColor: "#a479e2", textColor: "#ffffff" },
  { name: "Pink", backgroundColor: "#f691b3", textColor: "#000000" },
  { name: "Grey", backgroundColor: "#999999", textColor: "#ffffff" },
  { name: "Dark", backgroundColor: "#434343", textColor: "#ffffff" },
] as const;

export type LabelColor = { backgroundColor: string; textColor: string };
