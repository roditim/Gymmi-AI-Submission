// Follow the same explicit dialog/menu actions as a visitor.
async function editor(page){if(!await page.locator('#workout-dialog').evaluate(e=>e.open))await page.locator('#new-workout').click();}
async function account(page){if(!await page.locator('#account-dialog').evaluate(e=>e.open))await page.locator('#account-open').click();}
async function closeEditor(page){if(await page.locator('#workout-dialog').evaluate(e=>e.open))await page.locator('#close-editor').click();}
async function closeAccount(page){if(await page.locator('#account-dialog').evaluate(e=>e.open))await page.locator('#close-account').click();}
async function menu(card){if(!await card.locator('.card-menu').evaluate(e=>e.open))await card.locator('.card-menu>summary').click();}
async function dismissOnboarding(page){if(await page.locator('#onboarding[open]').isVisible())await page.locator('#onboarding-skip').click();}
module.exports={editor,account,closeEditor,closeAccount,menu,dismissOnboarding};
