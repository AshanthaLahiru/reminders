const yaml = require('js-yaml');
const visitor = require('probot-visitor');
const Freeze = require('./lib/freeze');
const formatParser = require('./lib/format-parser');
const githubHelper = require('./lib/github-helper');

/* Configuration Variables */

module.exports = robot => {
  robot.on('integration_installation.added', installationEvent);
  robot.on('issue_comment', handleFreeze);
  const visit = visitor(robot, {interval: 60 * 5 * 1000}, handleThaw);
  robot.on('test.visit', async context => {
    await handleThaw(75, context.payload.repository);
  });

  async function installationEvent(context) {
    const config = await getConfig(context.github, context.payload.repository);

    context.github.issues.getLabel(context.repositories_added[0]({
      name: config.labelName}).catch(() => {
        return context.github.issues.createLabel(context.repositories_added[0]({
          name: config.labelName,
          color: config.labelColor
        }));
      }));
  }

  async function handleFreeze(context) {
    const config = await getConfig(context.github, context.payload.repository);
    const freeze = new Freeze(context.github, config);

    const comment = context.payload.comment;
    freeze.config.perform = true;
    if (freeze.config.perform && !context.isBot && freeze.freezable(comment)) {
      freeze.freeze(
        context,
        freeze.propsHelper(comment.user.login, comment.body)
    );
    }
  }

  async function handleThaw(installation, repository) {
    const github = await robot.auth(installation.id);
    const config = await getConfig(github, repository);
    const freeze = new Freeze(github, config);

    github.search.issues({q:'label:' + freeze.config.labelName, repo:repository.full_name}).then(resp => {
      resp.data.items.forEach(issue => {
        github.issues.getComments(githubHelper.parseCommentURL(issue.comments_url)).then(resp => {
          return freeze.getLastFreeze(resp.data);
        }).then(lastFreezeComment => {
          if (freeze.unfreezable(lastFreezeComment)) {
            freeze.unfreeze(issue, formatParser.propFromComment(lastFreezeComment));
          }
        });
      });
    });
    console.log('visitor/thaw run complete');
  }

  async function getConfig(github, repository) {
    const owner = repository.owner.login;
    const repo = repository.name;
    const path = '.github/probot-snooze.yml';
    let config = {};

    try {
      const resp = await github.repos.getContent({owner, repo, path});
      config = Object.assign(yaml.load(Buffer.from(resp.data.content, 'base64').toString()) || {}, {perform:true});
    } catch (err) {
      console.log('error', err);
      visit.stop(repository);
    }

    return Object.assign(config, {owner, repo, logger: robot.log});
  }
};
