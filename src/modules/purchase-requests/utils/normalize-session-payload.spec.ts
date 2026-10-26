import { PurchaseRequestsService } from '../purchase-requests.service';

describe('normalizeSessionPayload', () => {
  const normalize = (body: Record<string, unknown>) =>
    PurchaseRequestsService.prototype.normalizeSessionPayload(body);

  it('omits boss, commission, and items when the client does not send them', () => {
    const dto = normalize({
      manualDocuments: true,
      comment: 'faqat bayroq',
    });

    expect(dto.manualDocuments).toBe(true);
    expect(dto.comment).toBe('faqat bayroq');
    expect(dto.bossId).toBeUndefined();
    expect(dto.commissionMemberIds).toBeUndefined();
    expect(dto.items).toBeUndefined();
  });

  it('keeps explicit empty arrays so the client can clear lists', () => {
    const dto = normalize({
      commissionMemberIds: [],
      items: [],
    });

    expect(dto.commissionMemberIds).toEqual([]);
    expect(dto.items).toEqual([]);
  });
});
