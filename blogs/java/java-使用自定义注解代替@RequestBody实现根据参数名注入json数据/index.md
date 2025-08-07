---
title: java-使用自定义注解代替@RequestBody实现根据参数名注入json数据
date: 2025/08/06 00:00:00
tags:
  - Java
---

## 一、背景

在进行接口开发时，经常会使用`@RequestBody`注解来将请求体中的json数据转换为java对象。

说实话，我并不太喜欢这种方式，因为它需要定义一个类，然后使用该类的实例来接受json数据，随着接口的增多，类的数量也会增加。

有的时候json数据很简单，只需要几个字段，这时就需要定义一个类来接收这些字段，再通过实例访问，就显得有些繁琐。

例如：

```json
{
  "name": "张三",
  "age": 30
}
```

```java

@PostMapping("/example")
public Result example(@RequestBody ExampleParam param) {
    String name = param.getName(); // 获取数据
    Integer age = param.getAge(); // 获取数据
    // ... 处理逻辑
    return Result.success("成功");
}
```

我就思考能不能直接将json数据注入到方法参数中，而不需要定义一个类。

例如：

```java

@PostMapping("/example")
public Result example(String name, Integer age) {
    // ... 处理逻辑
    return Result.success("成功");
}
```

显然是可以的，可以通过实现`HandlerMethodArgumentResolver`接口来实现自定义的参数解析器，根据参数名进行json数据的注入。

## 二、使用效果

案例1：

```json
{
  "name": "张三",
  "age": 30
}
```

```java

@JsonInject(JsonInjectMode.PART) // 使用自定义注解，标注该方法参数需要注入json数据，使用PART模式（默认），表示只注入部分字段
@PostMapping("/example")
public Result example(String name) {
    // ... 处理逻辑
    return Result.success("成功");
}
```

案例2：

```json
[
  1,
  2,
  3
]
```

```java

@JsonInject(JsonInjectMode.WHOLE) // 使用WHOLE模式，进行内容的整个注入
@PostMapping("/example")
public Result example(List<Integer> ids) {
    // ... 处理逻辑
    return Result.success("成功");
}
```

## 三、具体实现

`HandlerMethodArgumentResolver`是spring-web里面提供的参数解析器接口，他能够在controller的方法调用前对请求体的内容进行解析，然后作为参数传入方。

其需要实现两个方法：

- supportsParameter：判断当前解析器是否支持解析某个方法参数。
- resolveArgument：解析方法参数并返回解析后的值。

我们可以在`resolveArgument`读取请求体的json内容，然后使用fastjson进行解析参数。

最后使用`WebMvcConfigurer.addArgumentResolvers`添加解析器。

定义自定义注解和枚举：

```java
/**
 * 用于标记方法，指示该方法的参数应从JSON请求体中注入数据。
 * 支持两种注入模式：WHOLE（整个JSON对象）和PART（部分JSON对象）。
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface JsonInject {
    JsonInjectMode value() default JsonInjectMode.PART;

}
```

```java
/**
 * 用于标记方法参数，指示该参数应从JSON请求体中注入特定字段的值。
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.PARAMETER)
public @interface JsonField {

    String value();
}

```

```java
/**
 * JsonInjectMode 枚举类
 */
public enum JsonInjectMode {
    /**
     * WHOLE 模式：注入整个 JSON 对象
     */
    WHOLE,
    /**
     * PART 模式：注入 JSON 对象的部分字段
     */
    PART
}
```

```java
/**
 * JsonInject参数解析器
 * 该解析器用于处理带有@JsonInject注解的方法参数，将请求体中的JSON数据注入到方法参数中。
 * 支持两种模式：WHOLE（整个JSON对象）和PART（部分JSON对象）。
 */
@Component
public class JsonInjectResolver implements HandlerMethodArgumentResolver {

    /**
     * JsonInject的请求属性名称
     */
    private static final String JsonInject = "JsonInject";
    /**
     * JsonInject的作用域
     * 0表示请求作用域，1表示会话作用域，2表示全局作用域
     */
    private static final int Scope = 0;
    /**
     * 包装JSON对象的键
     */
    private static final String Key = "json";

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        // 检查方法参数是否有@JsonInject注解
        return parameter.getMethod().isAnnotationPresent(JsonInject.class);
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer, NativeWebRequest webRequest, WebDataBinderFactory binderFactory) throws Exception {
        // 获取ServletWebRequest对象
        ServletWebRequest request = (ServletWebRequest) webRequest;
        // 获取方法参数的类型
        Type type = parameter.getGenericParameterType();

        // 从请求属性中获取已解析的JSON对象，如果不存在则解析请求体中的JSON
        JSONObject json;
        if ((json = (JSONObject) request.getAttribute(JsonInject, Scope)) == null) {
            ServletInputStream stream = request.getRequest().getInputStream();
            json = JSONObject.parseObject(getJsonString(stream));
            request.setAttribute(JsonInject, json, Scope);
        }

        // 获取方法参数的注解和模式
        Method method = parameter.getMethod();
        JsonInject annotation = method.getAnnotation(JsonInject.class);
        // 获取注解的值，决定注入模式
        JsonInjectMode mode = annotation.value();
        // 如果模式是WHOLE，则直接返回整个JSON对象
        if (mode == JsonInjectMode.WHOLE) {
            return json.getObject(Key, type);
        }
        // 如果模式是PART，则根据注解或参数名获取特定字段的值
        if (mode == JsonInjectMode.PART) {
            String name;
            JsonField field;
            json = json.getJSONObject(Key);
            // 检查参数是否有@JsonField注解，如果有则使用注解中的值作为字段名，否则使用参数名
            if ((field = parameter.getParameterAnnotation(JsonField.class)) != null)
                name = field.value();
            else
                name = parameter.getParameterName();
            // 如果JSON对象中不存在该字段，则返回null
            if (json == null || !json.containsKey(name))
                return null;
            // 返回指定字段的值，转换为方法参数的类型
            return json.getObject(name, type);
        }
        return null;
    }

    /**
     * 从ServletInputStream中读取JSON字符串
     */
    private static String getJsonString(ServletInputStream stream) throws IOException {
        byte[] bytes = new byte[2048];
        int len;
        StringBuilder s = new StringBuilder();
        while ((len = stream.read(bytes)) != -1) {
            s.append(new String(bytes, 0, len));
        }
        stream.close();
        if (s.length() == 0)
            return "{}";
        return "{" + Key + ":" + s + "}";

    }
}
```

## 四、自动装配

为方便在其他项目中使用，我们编写一个starter，使用maven进行安装

```java
/**
 * JsonInject自动配置类
 */
@ConditionalOnWebApplication
@Import({JsonInjectResolver.class})
public class JsonInjectAutoConfiguration implements WebMvcConfigurer {

    private final JsonInjectResolver jsonInjectResolver;

    @Autowired
    public JsonInjectAutoConfiguration(JsonInjectResolver jsonInjectResolver) {
        this.jsonInjectResolver = jsonInjectResolver;
    }

    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(this.jsonInjectResolver);
    }
}
```

在spring.factories设置自动装配类:

```properties
org.springframework.boot.autoconfigure.EnableAutoConfiguration=\
  pers.renxian.jsoninject.JsonInjectAutoConfiguration
```

在pom.xml添加依赖:

[//]: # (@formatter:off)

```xml

<groupId>pers.renxian</groupId>
<artifactId>json-inject-starter</artifactId>
<version>1.0-SNAPSHOT</version>

<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
        <version>2.7.15</version>
    </dependency>
    <dependency>
        <groupId>com.alibaba</groupId>
        <artifactId>fastjson</artifactId>
        <version>2.0.32</version>
    </dependency>
</dependencies>
```

[//]: # (@formatter:on)

最后使用maven的install命令即可安装到本地库了，引用方式：

```xml

<dependency>
    <groupId>pers.renxian</groupId>
    <artifactId>json-inject-starter</artifactId>
    <version>1.0-SNAPSHOT</version>
</dependency>
```

## 五、拓展

@RequestBody还支持@Validation注解来进行参数校验，可以参照@RequestBody源码改为继承
`AbstractMessageConverterMethodArgumentResolver`，复用其`validateIfApplicable`方法进行校验。

```java
public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer, NativeWebRequest webRequest, WebDataBinderFactory binderFactory) throws Exception {
    parameter = parameter.nestedIfOptional();
    Object arg = this.readWithMessageConverters(webRequest, parameter, parameter.getNestedGenericParameterType());
    String name = Conventions.getVariableNameForParameter(parameter);
    if (binderFactory != null) {
        WebDataBinder binder = binderFactory.createBinder(webRequest, arg, name);
        if (arg != null) {
            this.validateIfApplicable(binder, parameter);
            if (binder.getBindingResult().hasErrors() && this.isBindExceptionRequired(binder, parameter)) {
                throw new MethodArgumentNotValidException(parameter, binder.getBindingResult());
            }
        }

        if (mavContainer != null) {
            mavContainer.addAttribute(BindingResult.MODEL_KEY_PREFIX + name, binder.getBindingResult());
        }
    }

    return this.adaptArgumentIfNecessary(arg, parameter);
}
```

Github地址：
