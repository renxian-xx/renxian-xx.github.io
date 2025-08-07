---
title: lua-通过设置闭包upvalue实现function直接访问table属性
date: 2025/08/07 00:00:00
tags:
  - Lua
---

## 一、背景

以前开发GG(Game Guardian，俗称GG修改器)的Lua脚本时，由于功能很多，在需要对脚本进行加密的情况下，不得不将很多模块塞到一个文件里。

开发时经常需要在脚本中定义一些全局变量或者文件顶级作用域的局部变量来存储状态或配置，就会导致变量污染问题，而且还有模块界线不清晰的问题。

如将下面两个模块放在同一个文件中，就会出现变量污染的问题，并且模块界限就变模糊了。

```lua
-- module1.lua
module_var1 = "value1"
module_var2 = "value2"

local function module_main()
    print(module_var1)
end

-- module2.lua
module_var1 = "value3"
module_var2 = "value4"

local function module_main()
    print(module_var1)
end
```

## 二、初步解决方案

初步的解决方案就是使用表来划分模块，具体采用了如下两种方式：

### 1. 使用全局变量

这方式虽然将内联到了表内，明确了模块界线，但如果module被重新赋值后，函数中的引用将失效。

```lua
module = { -- 使用全局变量定义一个模块
    var1 = "value1";
    var2 = "value2";
    main = function()
        print(module.var1) -- 使用全局变量来访问模块属性
    end;
}

```

### 2. 使用self关键字

这种方式虽然无法将函数内联到表中，但避免了重新赋值导致的函数引用失效的问题。

```lua
local module = { -- 使用局部变量定义一个模块
    var1 = "value1";
    var2 = "value2";
}

function module:main()
    print(self.var1) -- 使用self来访问模块属性
end
```

以上两种方式都使用一段时间后，发现始终不太满意，于是开始研究其他的方案。

## 三、最终解决方案和原理

最终我采用代理函数上值（upvalue）中的_ENV来实现函数直接访问模块属性。

当在表中定义函数main时，由于函数所处的作用域中没有变量key，Lua会在递归向上层作用域中查找变量key，最终会在_ENV中进行查找变量key。

```lua
local module = {
    key = "value";
    main = function()
        local tmp = key
    end;
}

-- 遍历函数的上值，源码中最多65536个上值
for i = 1, 65536 do
    local name, value = debug.getupvalue(module.main, i)
    if name == nil then
        break
    end
    print(name, value == _ENV) -- 输出：_ENV	true
end
```

_ENV是一个特殊的表，代表的是Lua的全局环境，访问_ENV中的变量，也就是访问全局变量，不需要显示引用。

并且无论_ENV中有没有key都会将_ENV添加到函数的上值中，如果上值中没有_ENV，则说明在向上查找过程中找到变量key（非_ENV内）。

我们可以通过debug.upvaluejoin修改函数的上值中_ENV的值，将其替换为函数所处的表，当函数内部作用域没有找到变量key，就会在表中查找，省去了显示引用。

## 四、代码实现

### 1. 第一版

第一版是直接访问表属性，代码如下：

```lua

SetEnvHandler = function(value, handler)
    for i = 1, 65536 do
        local name, upvalue = debug.getupvalue(value, i)
        if name == "_ENV" then
            -- 对_ENV进行代理
            local proxy_env = setmetatable({}, {
                __index = function(_, k)
                    return handler.get(upvalue, k)
                end;
                __newindex = function(_, k, v)
                    handler.set(upvalue, k, v)
                end;
            })
            -- 创建一个闭包，使其第一个上值为proxy_env
            local proxy_closure = function()
                local _ = proxy_env
            end
            debug.upvaluejoin(value, i, proxy_closure, 1) -- 使用proxy_closure的第一个上值替换_ENV
        end
        if name == nil or name == "_ENV" then
            break
        end
    end
    return value
end

-- 模板创建函数
Space = function(instance)
    local handler = {
        get = function(env, key)
            return instance[key] or env[key] -- 如果在instance中找不到，则从_ENV中查找
        end;
        set = function(env, key, value)
            instance[key] = value -- 将设置全局变量的操作代理到instance中
        end;
    }

    for _, v in pairs(instance) do
        -- 如果value是函数，则进行_ENV的代理
        if (type(v) == "function") then
            SetEnvHandler(v, handler)
        end
    end
    return setmetatable({}, {
        __index = function(_, key)
            return instance[key]
        end;
        __newindex = function(_, key, value)
            --对新增属性进行处理
            if (type(value) == "function") then
                value = SetEnvHandler(value, instance)
            end
            instance[key] = value
        end;
    })
end
```

使用效果：

```lua
local module = Space {
    key = "value";
    main = function()
        -- 访问模块属性
        print(key) -- value
        -- 修改模块属性
        key = "new_value"
        print(key) -- new_value
    end
}

module.main()
-- 判断是否有全局变量key
print(key) -- nil
-- 访问模块属性
print(module.key) -- new_value
```

这版虽然满足了我的需求，但这里面有些问题：

1. 在进行全局变量创建或修改时会被代理到指定的表中，这是不符合预期的。同样的在外层作用域出现同名局部变量时，访问和修改都会指向该局部变量。
2. 需要对每个函数都进行_ENV的代理，需要占用更多内存。

当然这版有一个好处就是外层作用域会随着_ENV扩散到内层，例如：

```lua
local module = Space {
    key = "value";
    main = function()
        local inner_module = Space {
            main = function()
                print(key) -- 可以访问到外层作用域的key
            end;
        }
        inner_module.main() -- 调用内层模块的main函数
    end;
}

module.main()
```

### 2. 第二版

第二版引入了自定义的关键字，`this`指向当前模块，`super`指向父模块，由于不再直接访问模块属性，所有的函数都可以使用同一个代理。

```lua
SetEnvProxy = function(value, proxy_closure)
    for i = 1, 65536 do
        local name, upvalue = debug.getupvalue(value, i)
        if name == "_ENV" then
            debug.upvaluejoin(value, i, proxy_closure, 1) -- 使用proxy_closure的第一个上值替换_ENV
        end
        if name == nil or name == "_ENV" then
            break
        end
    end
    return value
end

Space = function(instance, parent)
    local proxy_env = setmetatable({}, {
        __index = function(_, k)
            if k == "this" then
                return instance -- 如果访问this，则返回instance
            end
            if k == "super" then
                return parent -- 如果访问super，则返回parent
            end
            return _ENV[k] -- 否则返回_ENV中的对应值
        end;
        __newindex = function(_, k, v)
            _ENV[k] = v
        end;
    })
    -- 创建一个闭包，使其第一个上值为proxy_env
    local proxy_closure = function()
        local _ = proxy_env
    end

    for _, v in pairs(instance) do
        if (type(v) == "function") then
            SetEnvProxy(v, proxy_closure)
        end
    end
    -- 处理外部访问模块的情况，将访问和修改代理到instance中
    return setmetatable({}, {
        __index = function(_, key)
            return instance[key]
        end;
        __newindex = function(_, key, value)
            if (type(value) == "function") then
                value = SetEnvProxy(value, proxy_closure)
            end
            instance[key] = value
        end;
    })
end

-- 创建模块并继承一个父模块
SpaceExtend = function(parent)
    return function(instance)
        return Space(instance, parent)
    end
end
```

使用效果如下：

```lua
key = "global_value"
local module = Space {
    key = "value";
    main = function()
        -- 访问全局变量
        print(key) -- global_value
        -- 修改全局变量
        key = "new_global_value"
        print(key) -- new_global_value

        -- 访问模块属性
        print(this.key) -- value
        -- 修改模块属性
        this.key = "new_value"
        print(this.key) -- new_value

        -- 内部新增函数
        this.inner_test = function()
            print(this.key)
        end

        this.inner_module = SpaceExtend(this) {
            main = function()
                print(super.key) -- 访问父模块属性
            end;
        }

    end;
}

module.main()
module.inner_test() -- new_value

-- 外部新增函数
module.outer_test = function()
    print(this.key)
end

module.outer_test() -- new_value

print(module.key) -- new_value

module.inner_module.main() -- new_value
```

这一版基本满足了我的需求，能够直接在函数中访问模块属性，有效解决模块界线不清晰和变量污染的问题，同时避免了模块被重新赋值引起的函数引用失效。

Github地址：[lua-space](https://github.com/renxian-xx/lua-space.git)


