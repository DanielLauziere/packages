import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyDdl, FULL_DDL, seedDatabase } from './index.js'
function adapter(db: DatabaseSync){return{run:(s:string,p:unknown[]=[])=>db.prepare(s).run(...(p as any)),query:(s:string,p:unknown[]=[])=>db.prepare(s).all(...(p as any))}}
describe('seed FK',()=>{it('probe',()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys = ON');applyDdl(adapter(db),FULL_DDL)
  const seed={
    language:[{uuid:'lg',name:'es',nombre:'es'}],
    country:[{uuid:'ct-1',name:'El Salvador',nombre:'El Salvador',iso2:'SV',iso3:'SLV',phone_code:503,language_uuid:'lg'}],
    location_group:[{uuid:'lgg',name:'X',url_name:'x',country_uuid:'ct-1'}],
    combo:[{uuid:'cb1',name:'C',active:1,location_group_uuid:'lgg',price_whole:0,price_hundredths:0}],
    dining_table:[{uuid:'dt1',name:'T1',active:1,location_group_uuid:'lgg'}],
  }
  seedDatabase(adapter(db),seed as any)
  const all=(s:string)=>db.prepare(s).all()
  console.log('language',JSON.stringify(all('SELECT * FROM language')))
  console.log('country',JSON.stringify(all('SELECT * FROM country')))
  console.log('location_group',JSON.stringify(all('SELECT * FROM location_group')))
  console.log('location_group',JSON.stringify(all('SELECT * FROM location_group')))
  console.log('combo',JSON.stringify(all('SELECT * FROM combo')))
  console.log('dining_table',JSON.stringify(all('SELECT * FROM dining_table')))
  console.log('FKCHECK',JSON.stringify(all('PRAGMA foreign_key_check')))
  expect(true).toBe(true)
})})
