// Immutable get/set on nested objects by array path.
export function getPath(obj, path) {
  return path.reduce((a, k) => (a == null ? undefined : a[k]), obj);
}

export function setPath(obj, path, value) {
  if (path.length === 0) return value;
  const [k, ...rest] = path;
  const src = obj == null ? {} : obj;
  const clone = Array.isArray(src) ? [...src] : { ...src };
  clone[k] = setPath(src[k], rest, value);
  return clone;
}
