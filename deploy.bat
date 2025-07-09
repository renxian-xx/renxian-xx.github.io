

cd .vuepress/dist

git init
git add -A
git branch -m gh-pages
git commit -m 'deploy'


git push -f https://github.com/renxian-xx/renxian-xx.github.io.git gh-pages

cd -
