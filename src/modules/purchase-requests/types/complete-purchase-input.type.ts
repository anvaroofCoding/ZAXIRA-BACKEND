export interface CompletePurchasePurchasedItemInput {
  itemIndex: number;
  amount: number;
  name?: string;
  characteristics?: string;
  quantity?: number;
  unit?: string;
}

export interface CompletePurchaseInput {
  vendorName?: string;
  links: { label?: string; url: string }[];
  comment?: string;
  purchasedItems: CompletePurchasePurchasedItemInput[];
  fileLabels: string[];
}
