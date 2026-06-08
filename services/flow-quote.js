"use strict";

const PRODUCTS = [
  { id: "credito", title: "Crédito personal" },
  { id: "tarjeta", title: "Tarjeta de crédito" },
  { id: "seguro", title: "Seguro" },
];

function productTitle(id) {
  const p = PRODUCTS.find((x) => x.id === id);
  return p ? p.title : id || "—";
}

module.exports = { PRODUCTS, productTitle };
