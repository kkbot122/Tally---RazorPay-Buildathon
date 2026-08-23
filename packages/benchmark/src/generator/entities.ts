export type SyntheticEntity = {
  id: string;
  canonicalName: string;
  variants: readonly string[];
};

export const SYNTHETIC_ENTITIES: readonly SyntheticEntity[] = [
  { id: "ENT_ACME", canonicalName: "Acme Private Limited", variants: ["ACME PVT LTD", "Acme Pvt. Ltd."] },
  { id: "ENT_NOVA", canonicalName: "Nova Retail Private Limited", variants: ["NOVA RETAIL PVT LTD", "Nova Retail Pvt. Ltd."] },
  { id: "ENT_BLUEPEAK", canonicalName: "BluePeak Technologies Limited", variants: ["BLUEPEAK TECH LTD", "BluePeak Technologies"] },
  { id: "ENT_ORION", canonicalName: "Orion Foods Private Limited", variants: ["ORION FOODS PVT LTD", "Orion Foods"] },
  { id: "ENT_METRO", canonicalName: "Metro Supplies", variants: ["METRO SUPPLIES", "Metro Supply Co."] },
  { id: "ENT_ZENITH", canonicalName: "Zenith Services", variants: ["ZENITH SERVICES", "Zenith Service Co."] },
];
