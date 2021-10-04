function openPage(pageName,elmnt) {
  var i, tabcontent, tablinks;
  tabcontent = document.getElementsByClassName("tabcontent");
  for (i = 0; i < tabcontent.length; i++) {
    tabcontent[i].style.display = "none";
  }
  tablinks = document.getElementsByClassName("tablink");
  for (i = 0; i < tablinks.length; i++) {
    tablinks[i].style.backgroundColor = "";
    tablinks[i].style.color = "black";
  }
  document.getElementById(pageName).style.display = "block";
  elmnt.style.backgroundColor = "#FFE4B5";
  elmnt.style.color = "black";
}

// Get the element with id="defaultOpen" and click on it
document.getElementById("defaultOpen").click();
