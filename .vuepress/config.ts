import {defineUserConfig} from "vuepress";
import recoTheme from "vuepress-theme-reco";
import {viteBundler} from '@vuepress/bundler-vite'



export default defineUserConfig({
    title: "散客",
    description: "thank",
    lang: "zh-CN",
    head: [
        ["link", {rel: "icon", href: "/logo.svg"}],
    ],
    bundler: viteBundler(),
    theme: recoTheme({
        logo: "/logo.svg",
        author: "renxian",
        authorAvatar: "/avatar.jpg",
        docsRepo: "https://github.com/renxian-xx/renxian-xx.github.io",
        docsBranch: "main",
        lastUpdatedText: "上次更新于",
        navbar: [
            {text: "首页", link: "/"},
            {text: "时间线", link: "/timeline.html"},
        ],
        primaryColor: "#97caf9",
        editLink: false,
        categoriesText: "分类",
        tagsText: "标签"
    }),
});
