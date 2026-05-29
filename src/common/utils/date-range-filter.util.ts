export const appendDateRangeClause = (
  clauses: Record<string, unknown>[],
  field: string,
  dateFrom?: string,
  dateTo?: string,
) => {
  const range: Record<string, Date> = {};

  if (dateFrom?.trim()) {
    const from = new Date(dateFrom.trim());

    if (!Number.isNaN(from.getTime())) {
      from.setHours(0, 0, 0, 0);
      range.$gte = from;
    }
  }

  if (dateTo?.trim()) {
    const to = new Date(dateTo.trim());

    if (!Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      range.$lte = to;
    }
  }

  if (Object.keys(range).length) {
    clauses.push({ [field]: range });
  }
};
