/**
 * The config a `calculated`-edit-mode Field stores (inside `Field.validationRule`,
 * alongside `select`'s `options` — there's no dedicated column) and the pure
 * runtime that turns it into a value.
 *
 * Deliberately not a general formula/expression language: that's an
 * `eval`-shaped surface for arbitrary code to run inside a JSONB column, and a
 * much bigger, riskier build than this feature needs. Two narrow modes cover
 * the two shapes a calculated Field actually takes:
 *
 * - `arithmetic`: one binary operation over two operands, each either another
 *   Field's numeric value or a constant. Covers "Deal Value = Monthly Revenue
 *   × 12".
 * - `template`: a string with `{{field:<fieldId>}}` placeholders. Covers
 *   "{{field:company}} — {{field:marketplace}}".
 *
 * A calculated Field may only reference *non*-calculated Fields — chaining
 * calculated-on-calculated is refused at config time (`parseCalculationConfig`)
 * rather than supported, so there is no dependency graph to topologically
 * sort or detect cycles in at evaluation time.
 */

export type CalculationOperand =
  | { type: 'field'; fieldId: string }
  | { type: 'constant'; value: number };

export interface ArithmeticCalculation {
  kind: 'arithmetic';
  left: CalculationOperand;
  operator: '+' | '-' | '*' | '/';
  right: CalculationOperand;
}

export interface TemplateCalculation {
  kind: 'template';
  template: string;
}

export type CalculationConfig = ArithmeticCalculation | TemplateCalculation;

/** What `parseCalculationConfig` needs to know about a Field it might reference. */
export interface ReferenceableField {
  fieldType: string;
  editMode: string;
  active: boolean;
}

export type ParseCalculationResult =
  | { ok: true; config: CalculationConfig }
  | { ok: false; reason: string };

/**
 * Validates a calculated Field's config at *create/update* time — shape,
 * operator, and that every referenced Field id exists, is active, and is not
 * itself `calculated` (the no-chaining rule above). Never evaluates anything;
 * evaluation is `computeCalculatedValue` below, run per lead.
 *
 * Returns a result rather than throwing so callers can wrap the failure in
 * whichever error type their module already uses (`ConfigurationError` in
 * `apps/api/src/configuration`) instead of this shared, dependency-free
 * package inventing one both `configuration` and `leads` would have to
 * recognize.
 */
export function parseCalculationConfig(input: {
  raw: unknown;
  /** The fieldType of the Field *carrying* this calculation, not an operand's. */
  fieldType: string;
  /** This Field's own id, so a self-reference is refused — null when creating. */
  ownFieldId: string | null;
  referenceable: ReadonlyMap<string, ReferenceableField>;
}): ParseCalculationResult {
  const { raw } = input;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'calculation config is required for a calculated field' };
  }
  const kind = (raw as { kind?: unknown }).kind;

  if (kind === 'arithmetic') {
    if (input.fieldType !== 'number') {
      return { ok: false, reason: 'an arithmetic calculation requires a number field' };
    }
    const operator = (raw as { operator?: unknown }).operator;
    if (operator !== '+' && operator !== '-' && operator !== '*' && operator !== '/') {
      return { ok: false, reason: 'calculation operator must be one of + - * /' };
    }
    const left = parseOperand((raw as { left?: unknown }).left, input);
    if (!left.ok) return left;
    const right = parseOperand((raw as { right?: unknown }).right, input);
    if (!right.ok) return right;
    return {
      ok: true,
      config: { kind: 'arithmetic', left: left.operand, operator, right: right.operand },
    };
  }

  if (kind === 'template') {
    if (input.fieldType !== 'text' && input.fieldType !== 'textarea') {
      return { ok: false, reason: 'a template calculation requires a text or textarea field' };
    }
    const template = (raw as { template?: unknown }).template;
    if (typeof template !== 'string' || template.trim() === '') {
      return { ok: false, reason: 'calculation template must be a non-blank string' };
    }
    for (const fieldId of templateReferences(template)) {
      const reason = checkReference(fieldId, input);
      if (reason !== null) return { ok: false, reason };
    }
    return { ok: true, config: { kind: 'template', template } };
  }

  return { ok: false, reason: 'calculation kind must be "arithmetic" or "template"' };
}

function parseOperand(
  raw: unknown,
  input: { ownFieldId: string | null; referenceable: ReadonlyMap<string, ReferenceableField> },
): { ok: true; operand: CalculationOperand } | { ok: false; reason: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'calculation operand must be an object' };
  }
  const type = (raw as { type?: unknown }).type;
  if (type === 'constant') {
    const value = (raw as { value?: unknown }).value;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, reason: 'a constant operand must be a finite number' };
    }
    return { ok: true, operand: { type: 'constant', value } };
  }
  if (type === 'field') {
    const fieldId = (raw as { fieldId?: unknown }).fieldId;
    if (typeof fieldId !== 'string' || fieldId === '') {
      return { ok: false, reason: 'a field operand must name a fieldId' };
    }
    const reason = checkReference(fieldId, input);
    if (reason !== null) return { ok: false, reason };
    const referenced = input.referenceable.get(fieldId)!;
    if (referenced.fieldType !== 'number') {
      return { ok: false, reason: 'an arithmetic operand must reference a number field' };
    }
    return { ok: true, operand: { type: 'field', fieldId } };
  }
  return { ok: false, reason: 'calculation operand type must be "field" or "constant"' };
}

/** Shared by both operand and template reference checks. */
function checkReference(
  fieldId: string,
  input: { ownFieldId: string | null; referenceable: ReadonlyMap<string, ReferenceableField> },
): string | null {
  if (fieldId === input.ownFieldId) return 'a calculated field cannot reference itself';
  const referenced = input.referenceable.get(fieldId);
  if (referenced === undefined || !referenced.active) {
    return 'calculation references a field that does not exist';
  }
  if (referenced.editMode === 'calculated') {
    return 'a calculated field cannot reference another calculated field';
  }
  return null;
}

const templateTokenPattern = /\{\{field:([^}]+)\}\}/g;

function templateReferences(template: string): string[] {
  return [...template.matchAll(templateTokenPattern)].map((match) => match[1]!.trim());
}

/** Runtime type guard for a value read back out of `Field.validationRule`. */
export function isCalculationConfig(value: unknown): value is CalculationConfig {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'arithmetic' || kind === 'template';
}

/**
 * Evaluates a calculated Field's value for one lead's current field values.
 *
 * Returns `undefined` — "not computable yet", not an error — when an
 * arithmetic operand is missing or non-numeric (a lead need not have every
 * input filled in), including division by zero. A template never fails to
 * compute: a missing referenced value substitutes an empty string, so a
 * partially-filled-in record still gets a partial label rather than none.
 */
export function computeCalculatedValue(
  config: CalculationConfig,
  fieldValues: Readonly<Record<string, unknown>>,
): unknown {
  if (config.kind === 'template') {
    return config.template.replace(templateTokenPattern, (_match, fieldId: string) => {
      const value = fieldValues[fieldId.trim()];
      return value === null || value === undefined ? '' : String(value);
    });
  }
  const left = resolveOperand(config.left, fieldValues);
  const right = resolveOperand(config.right, fieldValues);
  if (left === undefined || right === undefined) return undefined;
  switch (config.operator) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      return right === 0 ? undefined : left / right;
  }
}

function resolveOperand(
  operand: CalculationOperand,
  fieldValues: Readonly<Record<string, unknown>>,
): number | undefined {
  if (operand.type === 'constant') return operand.value;
  const value = fieldValues[operand.fieldId];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
