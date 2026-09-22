// Pure projection: refreshing the page cannot award resources twice.
export const species = {
  animals: { name: 'Дуб заботы', label: 'Животные', kind: 'oak', color: '#497659' },
  people: { name: 'Цветы участия', label: 'Помощь людям', kind: 'flowers', color: '#cb836f' },
  elderly: { name: 'Яблоня тепла', label: 'Пожилые люди', kind: 'apple', color: '#84975c' },
  ecology: { name: 'Куст живой земли', label: 'Экология', kind: 'bush', color: '#6c925d' },
  education: { name: 'Дерево знаний', label: 'Образование', kind: 'knowledge', color: '#69958c' },
  donation: { name: 'Красный клён', label: 'Донорство', kind: 'maple', color: '#bd685e' },
  neighborhood: { name: 'Домик соседства', label: 'Свой район', kind: 'house', color: '#b79568' },
};
export function speciesFor(event = {}) {
  if (event.gardenCategory && species[event.gardenCategory]) return event.gardenCategory;
  // Explicit curated mapping; never infer a volunteer activity from a title alone.
  if (event.id === '11521651') return 'elderly';
  return species[event.category] ? event.category : 'people';
}
export function gardenFor(plans, userId) {
  const own = plans.filter(p => p.owner === userId);
  const saved = new Set(own.map(p => p.eventId));
  const agreed = new Set(own.filter(p => p.agreedAt || p.confirmed).map(p => p.eventId));
  const visits = new Map();
  for (const p of own.filter(p => p.status === 'done').sort((a,b) => String(a.completedAt).localeCompare(String(b.completedAt)))) {
    const key = `${p.eventId}:${p.when}`;
    if (!visits.has(key)) visits.set(key, p);
  }
  const completed = [...visits.values()];
  const objects = completed.map(p => ({ id:p.id, species:speciesFor(p.event), plan:p }));
  const hours = completed.reduce((sum,p) => sum + (Number.isFinite(p.hours) ? p.hours : 0), 0);
  return { objects, completed, hours, water:saved.size * 10 + agreed.size * 20 + completed.length * 100,
    sunlight:Math.round(hours * 50), level:1 + Math.floor(completed.length / 3),
    seedlings:own.filter(p => !['done','cancelled'].includes(p.status)),
    rare:completed.length >= 3, bench:completed.length >= 5, pond:completed.length >= 10 };
}
