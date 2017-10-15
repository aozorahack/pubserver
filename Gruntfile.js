module.exports = function(grunt) {
  grunt.initConfig({
    coffee: {
      glob_to_multiple: {
        expand: true,
        flatten: true,
        cwd: './',
        src: ['src/*.coffee', 'scraper/*.coffee'],
        dest: 'lib/',
        ext: '.js'
      }},
    uglify: {
      my_target: {
        files: {
          'public/js/aozora.min.js': [
            'src/js/jquery.columns.js',
            'src/js/mustache.js',
            'src/js/aozora.js'
          ]
        }
      }},
    sass: {
      dist: {
        options: {
          style: 'compressed',
          sourcemap: 'none'
        },
        files: {
          'public/css/aozora.css': 'src/scss/aozora.scss'
        }
      }},
    watch: {
      files: ["src/js/*.js"],
      tasks: ['uglify']
    }
  });
  grunt.loadNpmTasks('grunt-contrib-coffee');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-sass');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.registerTask('default', ['coffee', 'uglify', 'sass']);
};
