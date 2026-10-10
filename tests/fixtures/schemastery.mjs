// Minimal stand-in for the DSH Config schema used by the Host tests.
function field(type, properties = {}) {
  const chain = { type, ...properties, meta: {} }
  chain.default = (value) => { chain.meta.default = value; return chain }
  chain.volatile = () => { chain.meta.volatile = true; return chain }
  chain.description = (value) => { chain.meta.description = value; return chain }
  return chain
}

const z = {
  object(schema) { return { __schema: schema, dict: schema } },
  union(values) { return field('union', { values: Array.from(values) }) },
  string() { return field('string') },
}
export default z
