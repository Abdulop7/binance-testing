import { createStore } from "redux";

const reducer = (state = false, action) => {

    switch(action.type){
        case "ENABLE" : return true
        case "DISABLE" : return false
        default : return false
    }

}


export const store = createStore(reducer);