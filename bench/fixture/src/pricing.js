export function parseQuantity(value) {
  return Number(value);
}

export function lineTotal(priceCents, quantity) {
  return priceCents * quantity;
}

export function cartTotal(items) {
  return items.reduce(
    (sum, item) => sum + lineTotal(item.priceCents, item.quantity),
    0,
  );
}

export function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
