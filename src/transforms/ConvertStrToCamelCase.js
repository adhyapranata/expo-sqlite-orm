import toTitleCase from './ConvertStrToTitleCase'

export default (str, divider = '_') => {
  if (!str) return str
  const arr = str.split(divider)
  return arr.map((v, k) => (arr.length > 1 && k !== 0) ? toTitleCase(v) : v.toLowerCase()).join('')
}
