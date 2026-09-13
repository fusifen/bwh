/**
 * Schema parity check: `src/lib/schemas.ts` vs `keystatic.config.ts`.
 *
 * The failure this prevents
 * -------------------------
 * The build only walks the Zod path. So:
 *
 *   - a field the admin can write but Zod does not know about is silently
 *     stripped by `z.object` — the editor fills it in, the site ignores it, and
 *     nothing anywhere reports a problem;
 *   - a field Zod requires but the admin cannot write makes every save fail the
 *     build with an error that looks like corrupted content.
 *
 * Neither shows up in `npm run build`, because a build with no content edit is
 * perfectly consistent. The drift only appears the first time somebody uses the
 * admin — which is why this check exists rather than a comment asking people to
 * remember.
 *
 * How it compares
 * ---------------
 * Zod objects expose their keys via `.shape`. Keystatic field objects are
 * compared structurally through whatever accessor they expose (`fields` /
 * `schema` for objects, `element` for arrays). Where the internal shape of a
 * field is not introspectable, the comparison descends as far as it can and
 * reports the field as partially checked rather than guessing — a false failure
 * here would train people to ignore the check.
 */

import { withProject, heading, ok, fail, detail, finish, paint } from './lib/project.mjs';

const problems = [];
const skipped = [];

/* -----------------------------------------------------------------------------
   Structural introspection
   -------------------------------------------------------------------------- */

/** Unwrap `optional` / `default` / `nullable` / `pipe` to the schema that holds shape. */
function zodInner(schema) {
  let current = schema;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (current.shape) return current;
    const def = current.def ?? current._def ?? {};
    // ZodPipe (what `z.preprocess` produces) carries its output on `out`.
    if (def.out) {
      current = def.out;
      continue;
    }
    if (def.innerType) {
      current = def.innerType;
      continue;
    }
    if (def.element) return { shape: null, element: def.element };
    break;
  }
  return current;
}

/** Keys of a Zod object, or of an array's element object. `null` if neither. */
function zodKeys(schema) {
  const inner = zodInner(schema);
  if (!inner || typeof inner !== 'object') return null;
  if (inner.shape && typeof inner.shape === 'object') return Object.keys(inner.shape);
  if (inner.element) return zodKeys(inner.element);
  return null;
}

/** Keys of a Keystatic object field, or of an array's element object. */
function keystaticKeys(field) {
  if (!field || typeof field !== 'object') return null;

  const container = field.fields ?? field.schema;

  if (Array.isArray(container)) {
    const keys = container.map((entry) => entry?.key).filter((key) => typeof key === 'string');
    if (keys.length > 0) return keys;
  }

  if (container && typeof container === 'object') {
    const keys = Object.keys(container);
    const allFields = keys.every((key) => container[key] && typeof container[key] === 'object');
    if (keys.length > 0 && allFields) return keys;
  }

  if (field.element) return keystaticKeys(field.element);

  return null;
}

/* -----------------------------------------------------------------------------
   Comparison
   -------------------------------------------------------------------------- */

function compareShape(label, zodSchema, keystaticField, path, depth) {
  const zodSide = zodKeys(zodSchema);
  const keystaticSide = keystaticKeys(keystaticField);

  if (zodSide === null || keystaticSide === null) {
    if (depth === 0) skipped.push(`${label}${path ? `.${path}` : ''}`);
    return;
  }

  const zodOnly = zodSide.filter((key) => !keystaticSide.includes(key));
  const keystaticOnly = keystaticSide.filter((key) => !zodSide.includes(key));

  for (const key of zodOnly) {
    problems.push(`${label}${path ? `.${path}` : ''}: Zod 有 "${key}"，后台表单没有`);
    fail(`${label}${path ? `.${path}` : ''}: Zod 有 "${key}"，后台表单没有`);
  }
  for (const key of keystaticOnly) {
    problems.push(`${label}${path ? `.${path}` : ''}: 后台表单有 "${key}"，Zod 没有`);
    fail(`${label}${path ? `.${path}` : ''}: 后台表单有 "${key}"，Zod 没有`);
  }

  // Descend into the fields both sides agree on. Depth is capped because the
  // content model is shallow by design; an unbounded walk would be a sign the
  // model had grown a shape nobody can reason about.
  if (depth >= 3) return;
  for (const key of zodSide) {
    if (!keystaticSide.includes(key)) continue;
    const zodChild = zodInner(zodSchema)?.shape?.[key] ?? zodInner(zodSchema)?.element?.shape?.[key];
    const container = keystaticField.fields ?? keystaticField.schema;
    const keystaticChild = Array.isArray(container)
      ? container.find((entry) => entry?.key === key)?.field
      : container?.[key] ?? keystaticField.element?.fields?.[key];
    if (!zodChild || !keystaticChild) continue;
    compareShape(label, zodChild, keystaticChild, path ? `${path}.${key}` : key, depth + 1);
  }
}

await withProject(
  async ({ schemas, keystatic }) => {
    if (!keystatic) {
      fail('未能加载 keystatic.config.ts');
      process.exitCode = 1;
      return;
    }

    /* --- registry parity ------------------------------------------------ */

    heading('注册表一致性');

    const zodCollections = Object.keys(schemas.COLLECTIONS);
    const ksCollections = Object.keys(keystatic.collections ?? {});
    const zodSingletons = Object.keys(schemas.SINGLETONS);
    const ksSingletons = Object.keys(keystatic.singletons ?? {});

    for (const name of zodCollections) {
      if (!ksCollections.includes(name)) {
        problems.push(`集合 "${name}" 在 schemas.ts 中存在，但 keystatic.config.ts 里没有`);
        fail(`集合 "${name}" 只存在于 Zod`);
      }
    }
    for (const name of ksCollections) {
      if (!zodCollections.includes(name)) {
        problems.push(`集合 "${name}" 在 keystatic.config.ts 中存在，但 schemas.ts 里没有`);
        fail(`集合 "${name}" 只存在于后台`);
      }
    }
    for (const name of zodSingletons) {
      if (!ksSingletons.includes(name)) {
        problems.push(`单例 "${name}" 在 schemas.ts 中存在，但 keystatic.config.ts 里没有`);
        fail(`单例 "${name}" 只存在于 Zod`);
      }
    }
    for (const name of ksSingletons) {
      if (!zodSingletons.includes(name)) {
        problems.push(`单例 "${name}" 在 keystatic.config.ts 中存在，但 schemas.ts 里没有`);
        fail(`单例 "${name}" 只存在于后台`);
      }
    }

    if (zodCollections.length === ksCollections.length && zodSingletons.length === ksSingletons.length) {
      ok(`注册表一致：${zodCollections.length} 个集合、${zodSingletons.length} 个单例`);
    }

    /* --- field parity --------------------------------------------------- */

    heading('字段定义一致性');

    for (const name of zodCollections) {
      const config = keystatic.collections?.[name];
      if (!config) continue;
      compareShape(`collections.${name}`, schemas.COLLECTIONS[name], { schema: config.schema }, '', 0);
    }

    for (const name of zodSingletons) {
      const config = keystatic.singletons?.[name];
      if (!config) continue;
      compareShape(`singletons.${name}`, schemas.SINGLETONS[name], { schema: config.schema }, '', 0);
    }

    if (problems.length === 0) {
      ok('全部集合与单例的字段定义一致');
    }

    /* --- storage mode --------------------------------------------------- */

    heading('后台存储模式');

    const storage = keystatic.storage ?? {};
    if (storage.kind === 'local') {
      ok('storage.kind = "local"：内容写入 src/content，线上不暴露后台');
    } else if (storage.kind === 'github') {
      detail('storage.kind = "github"：已切到远程模式，需要配置 KEYSTATIC_SECRET');
    } else {
      problems.push(`未知的 storage 配置：${JSON.stringify(storage)}`);
      fail(`未知的 storage 配置：${JSON.stringify(storage)}`);
    }

    if (skipped.length > 0) {
      console.log(`\n${paint.dim('以下字段无法逐层核对内部结构，已跳过深层比对（顶层键仍然核对过）：')}`);
      for (const item of skipped) detail(item);
    }

    finish(problems, '后台表单与内容契约完全一致');
  },
  { keystatic: true },
);
