import { create, all } from 'mathjs';

const math = create(all);

export default function mathFunction(params, expr) {
  const mfunc = math.compile(expr).evaluate;
  return (...args) => {
    return mfunc(Object.fromEntries(params.map((name, i) => [name, args[i]])));
  };
}
