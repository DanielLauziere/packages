import { v5, parse } from 'uuid';
const ns = parse('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
const cases = [
  ['user@domain.com', '2a369f48-9bf8-5626-a79a-f6bbc7257307'],
  ['5551234', '89d490335463c5e34416236d1a9c2b11e16c9f29'],
];
let ok = true;
for (const [name, want] of cases) {
  const g = v5(ns, name);
  console.log('v5(ns,' + JSON.stringify(name) + ') = ' + g + ' ' + (g===want?'OK':'FAIL want') + ' ' + want);
  if (g !== want) ok = false;
}
console.log('canonical v5(ns, user@domain.com) = ' + v5(ns, 'user@domain.com'));
console.log('ALL OK:', ok);
