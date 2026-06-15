const FIELD_LABELS: Record<string, string> = {
  fullName: 'To‘liq nomi',
  shortName: 'Qisqa nomi',
  hasWarehouse: 'Ombori bormi',
  hasLeader: 'Raxbarmi',
  leaderName: 'Raxbari F.I.O.',
  isActive: 'Holat',
  login: 'Login',
  password: 'Parol',
  displayName: 'Ism',
  position: 'Lavozim',
  structureId: 'Tarkibiy tuzilma',
  permissions: 'Ruxsatlar',
};

const fieldLabel = (key: string) => FIELD_LABELS[key] ?? key;

export const translateValidationMessage = (message: unknown): string => {
  if (typeof message !== 'string') {
    return String(message);
  }

  let match = message.match(/^property (\w+) should not exist$/);
  if (match) {
    return `«${fieldLabel(match[1])}» maydoni qabul qilinmaydi`;
  }

  match = message.match(/^property (\w+) should not be empty$/);
  if (match) {
    return `«${fieldLabel(match[1])}» bo‘sh bo‘lmasligi kerak`;
  }

  match = message.match(/^(\w+) must be a boolean value$/);
  if (match) {
    return `«${fieldLabel(match[1])}» faqat Ha yoki Yo‘q bo‘lishi kerak`;
  }

  match = message.match(/^(\w+) must be a string$/);
  if (match) {
    return `«${fieldLabel(match[1])}» matn bo‘lishi kerak`;
  }

  match = message.match(/^(\w+) should not be empty$/);
  if (match) {
    return `«${fieldLabel(match[1])}» bo‘sh bo‘lmasligi kerak`;
  }

  match = message.match(/^(\w+) must be longer than or equal to (\d+) characters?$/);
  if (match) {
    return `«${fieldLabel(match[1])}» kamida ${match[2]} belgidan iborat bo‘lishi kerak`;
  }

  match = message.match(/^(\w+) must be shorter than or equal to (\d+) characters?$/);
  if (match) {
    return `«${fieldLabel(match[1])}» ${match[2]} belgidan oshmasligi kerak`;
  }

  return message;
};

export const translateValidationMessages = (
  messages: string | string[],
): string[] => {
  const list = Array.isArray(messages) ? messages : [messages];
  return list.map(translateValidationMessage);
};
