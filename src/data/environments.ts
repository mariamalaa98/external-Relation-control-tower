/** Default `npm run push` target. Keep power.config.json environmentId equal to this id. */
export const PUSH_ENVIRONMENT = {
  id: "cd78a59b-e16f-e4aa-b0a1-8e450a70ed56",
  url: "https://org998df960.crm4.dynamics.com",
  name: "Code App Development",
} as const;

/** Dataverse org every read and write targets. This is the live IT environment. */
export const DATA_ENVIRONMENT = {
  id: "24b23b77-4d64-e7f5-9796-36a7b12bb75e",
  url: "https://org2f45e702.crm4.dynamics.com",
  name: "Live",
} as const;
