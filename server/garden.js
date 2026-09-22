export function validateHours(value = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 24 || value * 2 % 1 !== 0) {
    throw new Error('Укажи от 0 до 24 часов с шагом в полчаса.');
  }
  return value;
}
