(module
  (import "./add-esmi-deps.mjs" "getValue" (func $getValue (result i32)))

  (func (export "addImported") (param $a i32) (result i32)
    local.get $a
    call $getValue
    i32.add
  )
)
