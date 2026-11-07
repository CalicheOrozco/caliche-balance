/* Text for the app's frame: the floating tab bar and the shared headers. Every key needs both languages. */
const es = {
  "nav.body": "Cuerpo",
  "nav.main": "Principal",
  "nav.addMeasurement": "Agregar medición",
  "nav.profile": "Tu perfil",
  "nav.back": "Volver",
};

export const shellCopy = {
  es,
  en: {
    "nav.body": "Body",
    "nav.main": "Main",
    "nav.addMeasurement": "Add a measurement",
    "nav.profile": "Your profile",
    "nav.back": "Back",
  } satisfies Record<keyof typeof es, string>,
};
