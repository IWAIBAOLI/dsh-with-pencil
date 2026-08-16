// Minimal schemastery stand-in for tests: the plugin only uses z.object with
// .string()/.default()/.description() when declaring its config schema.
const z = {
  object(schema) { return { __schema: schema } },
  union(values) {
    const chain = { type: 'union', values: Array.from(values) }
    chain.default = () => chain
    chain.description = () => chain
    return chain
  },
  string() {
    const chain = { type: 'string' }
    chain.default = () => chain
    chain.description = () => chain
    return chain
  },
}
export default z
