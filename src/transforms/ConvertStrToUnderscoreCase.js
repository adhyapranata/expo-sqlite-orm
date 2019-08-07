export default (str) => {
  if (!str) return str
  return str.replace(/\.?([A-Z])/g, function (x, y) {
    return '_' + y.toLowerCase()
  }).replace(/^_/, '')
}
