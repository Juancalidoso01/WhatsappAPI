"use strict";

/**
 * Categorías orientadas al usuario (estilo Meta Business).
 * Cada categoría enlaza samples existentes o queda como solicitud para revisión.
 */
const USE_CASES = [
  {
    id: "ventas",
    label: "Ventas y comercio",
    icon: "cart",
    description: "Catálogo interactivo, cotizaciones, selección de productos, pago inicial y captura de datos de entrega.",
    samples: ["quote"],
    status: "available",
  },
  {
    id: "reservas",
    label: "Reservas y citas",
    icon: "calendar",
    description: "Agendar, reprogramar o cancelar citas; elegir sucursal, fecha y hora; confirmar asistencia.",
    samples: ["booking"],
    status: "available",
    featured: true,
  },
  {
    id: "atencion",
    label: "Atención al cliente",
    icon: "support",
    description: "Clasificar el motivo de contacto, abrir tickets, recopilar información antes de transferir a un agente y dar seguimiento.",
    samples: ["lead"],
    status: "available",
  },
  {
    id: "pagos",
    label: "Pagos y cobranza",
    icon: "payment",
    description: "Consultar saldo, elegir método de pago, confirmar comprobantes, verificación 3DS para aprobar pagos y programar recordatorios.",
    samples: ["payment_auth"],
    status: "available",
    featured: true,
  },
  {
    id: "onboarding",
    label: "Onboarding y KYC",
    icon: "kyc",
    description: "Capturar datos personales, aceptar términos y condiciones, subir documentos y validar información.",
    samples: ["kyc"],
    status: "available",
  },
  {
    id: "productos",
    label: "Productos Punto Pago",
    icon: "megaphone",
    description: "Tours interactivos por producto: conoce beneficios y pasos para solicitarlos desde la app.",
    samples: ["tarjeta_credito"],
    status: "available",
    featured: true,
  },
  {
    id: "marketing",
    label: "Marketing y fidelización",
    icon: "megaphone",
    description: "Registro a promociones, inscripción a eventos, programas de puntos y referidos.",
    samples: ["marketing"],
    status: "available",
  },
  {
    id: "logistica",
    label: "Logística y entregas",
    icon: "truck",
    description: "Confirmar dirección, elegir ventana de entrega, rastrear pedidos y reportar incidencias.",
    samples: ["logistics"],
    status: "available",
  },
  {
    id: "rrhh",
    label: "Recursos humanos",
    icon: "briefcase",
    description: "Postulaciones, actualización de datos, solicitud de vacaciones y encuestas internas.",
    samples: [],
    status: "soon",
  },
];

function listUseCases() {
  return USE_CASES.map((u) => ({
    id: u.id,
    label: u.label,
    icon: u.icon,
    description: u.description,
    sampleKeys: u.samples,
    status: u.status,
    featured: Boolean(u.featured),
    templateCount: u.samples.length,
  }));
}

function getUseCase(id) {
  return USE_CASES.find((u) => u.id === id) || null;
}

module.exports = { USE_CASES, listUseCases, getUseCase };
