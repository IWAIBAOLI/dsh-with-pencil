// Minimal stand-in for the DSH Config schema used by the Host tests.
const z = {
  object(schema) { return { __schema: schema } },
  union(values) {
    const chain = { type: 'union', values: Array.from(values) }
    chain.default = () => chain
    chain.volatile = () => chain
    chain.description = () => chain
    return chain
  },
  string() {
    const chain = { type: 'string' }
    chain.default = () => chain
    chain.volatile = () => chain
    chain.description = () => chain
    return chain
  },
}
export default z
