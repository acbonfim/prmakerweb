export interface CardAlerts {
  missingRootCause: boolean;
  missingResolutionType: boolean;
  missingGeneralClassification: boolean;
  missingClassification: boolean;
  /** Bug sem Bug Type (picklist do DevOps); sempre false em User Story. */
  missingBugType?: boolean;
  remainingNotZero: boolean;
}

export interface CardComment {
  id: number;
  text?: string;
  createdByName?: string;
  createdDate?: string;
  modifiedDate?: string;
}

export interface CardFieldChange {
  field: string;
  oldValue?: string;
  newValue?: string;
}

export interface CardHistory {
  rev: number;
  changedByName?: string;
  changedDate?: string;
  changes: CardFieldChange[];
}

export interface CardFull {
  id: number;
  rev: number;
  url?: string;
  fields: Record<string, any>;
  comments: CardComment[];
  history: CardHistory[];
  alerts: CardAlerts;
  error?: string;
}
