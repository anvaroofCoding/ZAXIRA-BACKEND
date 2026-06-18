export interface CompletePurchasePurchasedItemInput {
  itemIndex: number;
  amount: number;
  vatRate?: number;
  vatAmount?: number;
  name?: string;
  characteristics?: string;
  quantity?: number;
  unit?: string;
}

export interface CompletePurchaseInput {
  vendorName?: string;
  contractNumber?: string;
  organizationName?: string;
  innOrPinfl?: string;
  innOrPinflType?: 'inn' | 'pinfl' | '';
  links: { label?: string; url: string }[];
  comment?: string;
  purchasedItems: CompletePurchasePurchasedItemInput[];
  fileLabels: string[];
}
