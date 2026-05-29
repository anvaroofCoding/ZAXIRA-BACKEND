export interface CompletePurchaseInput {
  vendorName: string;
  links: { label?: string; url: string }[];
  comment?: string;
  itemAmounts: { itemIndex: number; amount: number }[];
  fileLabels: string[];
}
