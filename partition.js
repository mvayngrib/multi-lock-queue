const partition = (arr, condition) => {
  const yes = []
  const no = []
  for (const item of arr) {
    const side = condition(item) ? yes : no
    side.push(item)
  }

  return [yes, no]
}

module.exports = {
  partition,
}
